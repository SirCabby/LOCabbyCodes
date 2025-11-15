//=============================================================================
// CabbyCodes Settings
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Settings - In-game settings menu for mod features
 * @author CabbyCodes
 * @help
 * Provides an in-game settings menu integrated into the Options screen.
 * All CabbyCodes mod features can be toggled from here.
 */

(() => {
    'use strict';

    // Ensure CabbyCodes namespace exists
    if (typeof window.CabbyCodes === 'undefined') {
        window.CabbyCodes = {};
    }
    
    const SETTING_SYMBOL_PREFIX = 'cabbycodes_';
    const CABBYCODES_OPTION_BG_COLOR_START = 'rgba(88, 176, 255, 0.3)';
    const CABBYCODES_OPTION_BG_COLOR_END = 'rgba(88, 176, 255, 0.08)';
    const CABBYCODES_OPTION_BG_COLOR_BORDER = 'rgba(88, 176, 255, 0.35)';
    const CABBYCODES_OPTION_BG_PADDING = 2;
    
    // Settings registry - stores all registered settings
    CabbyCodes.settingsRegistry = CabbyCodes.settingsRegistry || [];
    
    /**
     * Retrieves metadata for a previously registered setting.
     * @param {string} key
     * @returns {object|undefined}
     */
    CabbyCodes.getSettingDefinition = function(key) {
        return CabbyCodes.settingsRegistry.find(setting => setting.key === key);
    };
    
    /**
     * Registers a new setting definition. Supports both legacy boolean signature
     * and an extended options object for advanced controls (text/number inputs).
     * @param {string} key
     * @param {string} displayName
     * @param {boolean|object} defaultOrOptions
     * @param {Function|null} onChange
     */
    CabbyCodes.registerSetting = function(key, displayName, defaultOrOptions = false, onChange = null) {
        const options = normalizeSettingOptions(defaultOrOptions, onChange);
        const definition = {
            key: key,
            displayName: displayName,
            defaultValue: options.defaultValue,
            onChange: options.onChange,
            type: options.type,
            min: options.min,
            max: options.max,
            step: options.step,
            maxDigits: options.maxDigits,
            formatValue: options.formatValue,
            inputTitle: options.inputTitle,
            inputDescription: options.inputDescription,
            applyOnClose: options.applyOnClose,
            order: typeof options.order === 'number' ? options.order : 100
        };
        
        CabbyCodes.settingsRegistry.push(definition);
        CabbyCodes.settingsRegistry.sort((a, b) => {
            return (a.order || 0) - (b.order || 0);
        });
        
        if (!CabbyCodes.settings.hasOwnProperty(key)) {
            CabbyCodes.setSetting(key, definition.defaultValue);
        }
    };
    
    /**
     * Normalizes options for registerSetting to support advanced metadata.
     * @param {boolean|object} defaultOrOptions
     * @param {Function|null} onChange
     * @returns {object}
     */
    function normalizeSettingOptions(defaultOrOptions, onChange) {
        let options;
        if (typeof defaultOrOptions === 'object' && defaultOrOptions !== null) {
            options = Object.assign(
                {
                    defaultValue: false,
                    type: 'boolean',
                    onChange: onChange || defaultOrOptions.onChange || null,
                    min: null,
                    max: null,
                    step: 1,
                    maxDigits: null,
                    formatValue: null,
                    inputTitle: '',
                    inputDescription: '',
                    applyOnClose: false,
                    order: 100
                },
                defaultOrOptions
            );
        } else {
            options = {
                defaultValue: defaultOrOptions,
                onChange: onChange,
                type: 'boolean',
                min: null,
                max: null,
                step: 1,
                maxDigits: null,
                formatValue: null,
                inputTitle: '',
                inputDescription: '',
                applyOnClose: false,
                order: 100
            };
        }
        
        if (!options.type) {
            options.type = 'boolean';
        }
        
        return options;
    }
    
    /**
     * Converts a CabbyCodes setting key into the Window_Options symbol.
     * @param {string} key
     * @returns {string}
     */
    function cabbyCodesSymbol(key) {
        return `${SETTING_SYMBOL_PREFIX}${key}`;
    }

    function isCabbyCodesSymbol(symbol) {
        return typeof symbol === 'string' && symbol.startsWith(SETTING_SYMBOL_PREFIX);
    }

    function shouldDisplayCabbyCodesOptions() {
        if (typeof CabbyCodes.canShowCabbyCodesOptions === 'function') {
            try {
                return Boolean(CabbyCodes.canShowCabbyCodesOptions());
            } catch (error) {
                CabbyCodes.warn(`[CabbyCodes] Failed to check options visibility: ${error?.message || error}`);
                return false;
            }
        }
        if (typeof $gameParty !== 'undefined' && typeof $gameParty.members === 'function') {
            return $gameParty.members().length > 0;
        }
        return false;
    }
    
    /**
     * Applies a value change for a setting, invoking callbacks as needed.
     * @param {string} key
     * @param {*} value
     */
    CabbyCodes.applySettingValue = function(key, value) {
        const definition = CabbyCodes.getSettingDefinition(key);
        const defaultValue = definition ? definition.defaultValue : false;
        const oldValue = CabbyCodes.getSetting(key, defaultValue);
        if (oldValue === value) {
            return;
        }
        CabbyCodes.setSetting(key, value);
        if (definition && typeof definition.onChange === 'function') {
            try {
                definition.onChange(value, oldValue);
            } catch (error) {
                CabbyCodes.error(`[CabbyCodes] Setting onChange error for ${key}: ${error?.message || error}`);
            }
        }
    };
    
    /**
     * Normalizes user-provided values to respect setting metadata.
     * @param {object} definition
     * @param {*} value
     * @returns {*}
     */
    CabbyCodes.normalizeSettingValue = function(definition, value) {
        if (!definition || definition.type === 'boolean') {
            return Boolean(value);
        }
        
        if (definition.type === 'number') {
            let numeric = Number(value);
            if (!Number.isFinite(numeric)) {
                numeric = definition.defaultValue || 0;
            }
            numeric = Math.round(numeric);
            if (typeof definition.min === 'number') {
                numeric = Math.max(definition.min, numeric);
            }
            if (typeof definition.max === 'number') {
                numeric = Math.min(definition.max, numeric);
            }
            return numeric;
        }
        
        return value;
    };
    
    /**
     * Get setting display name
     */
    CabbyCodes.getSettingDisplayName = function(key) {
        const setting = CabbyCodes.settingsRegistry.find(s => s.key === key);
        return setting ? setting.displayName : key;
    };
    
    // Hook into Window_Options to add CabbyCodes settings
    const _Window_Options_addGeneralOptions = Window_Options.prototype.addGeneralOptions;
    Window_Options.prototype.addGeneralOptions = function() {
        _Window_Options_addGeneralOptions.call(this);
        
        if (!shouldDisplayCabbyCodesOptions()) {
            return;
        }
        
        CabbyCodes.settingsRegistry.forEach(setting => {
            this.addCommand(setting.displayName, cabbyCodesSymbol(setting.key), true);
        });
    };
    
    // Hook into Window_Options to handle setting values
    const _Window_Options_getConfigValue = Window_Options.prototype.getConfigValue;
    Window_Options.prototype.getConfigValue = function(symbol) {
        if (symbol.startsWith(SETTING_SYMBOL_PREFIX)) {
            const key = symbol.replace(SETTING_SYMBOL_PREFIX, '');
            const definition = CabbyCodes.getSettingDefinition(key);
            const defaultValue = definition ? definition.defaultValue : false;
            return CabbyCodes.getSetting(key, defaultValue);
        }
        return _Window_Options_getConfigValue.call(this, symbol);
    };
    
    // Hook into Window_Options to handle setting changes
    const _Window_Options_setConfigValue = Window_Options.prototype.setConfigValue;
    Window_Options.prototype.setConfigValue = function(symbol, value) {
        if (symbol.startsWith(SETTING_SYMBOL_PREFIX)) {
            const key = symbol.replace(SETTING_SYMBOL_PREFIX, '');
            const definition = CabbyCodes.getSettingDefinition(key);
            if (definition && definition.type === 'boolean') {
                CabbyCodes.applySettingValue(key, Boolean(value));
            } else if (definition) {
                const normalized = CabbyCodes.normalizeSettingValue(definition, value);
                CabbyCodes.applySettingValue(key, normalized);
            } else {
                CabbyCodes.setSetting(key, value);
            }
        } else {
            _Window_Options_setConfigValue.call(this, symbol, value);
        }
    };
    
    /**
     * Opens a dedicated number input scene for CabbyCodes settings.
     * @param {object} definition
     * @param {number} initialValue
     * @param {object} callbacks
     */
    CabbyCodes.openNumberInput = function(definition, initialValue, callbacks = {}) {
        if (typeof SceneManager === 'undefined' || typeof Scene_CabbyCodesNumberInput === 'undefined') {
            CabbyCodes.warn('[CabbyCodes] Number input scene unavailable.');
            return;
        }
        SceneManager.push(Scene_CabbyCodesNumberInput);
        SceneManager.prepareNextScene(definition, initialValue, callbacks);
    };
    
    // Hook into Window_Options status text for boolean/numeric display
    const _Window_Options_statusText = Window_Options.prototype.statusText;
    Window_Options.prototype.statusText = function(index) {
        const symbol = this.commandSymbol(index);
        if (symbol.startsWith(SETTING_SYMBOL_PREFIX)) {
            const key = symbol.replace(SETTING_SYMBOL_PREFIX, '');
            const definition = CabbyCodes.getSettingDefinition(key);
            const value = this.getConfigValue(symbol);
            if (definition && typeof definition.formatValue === 'function') {
                return definition.formatValue(value);
            }
            if (definition && definition.type === 'number') {
                return String(value);
            }
            return this.booleanStatusText(!!value);
        }
        return _Window_Options_statusText.call(this, index);
    };
    
    // Intercept OK handling to show custom editors for numeric settings
    const _Window_Options_processOk = Window_Options.prototype.processOk;
    Window_Options.prototype.processOk = function() {
        const symbol = this.commandSymbol(this.index());
        if (symbol && symbol.startsWith(SETTING_SYMBOL_PREFIX)) {
            const key = symbol.replace(SETTING_SYMBOL_PREFIX, '');
            const definition = CabbyCodes.getSettingDefinition(key);
            if (definition && definition.type === 'number') {
                const currentValue = CabbyCodes.getSetting(key, definition.defaultValue);
                CabbyCodes.openNumberInput(definition, currentValue, {
                    onApply: value => {
                        const normalized = CabbyCodes.normalizeSettingValue(definition, value);
                        CabbyCodes.applySettingValue(key, normalized);
                    },
                    onCancel: () => {}
                });
                return;
            }
        }
        _Window_Options_processOk.call(this);
    };

    const _Window_Options_drawItemBackground = Window_Options.prototype.drawItemBackground;
    Window_Options.prototype.drawItemBackground = function(index) {
        const symbol = this.commandSymbol(index);
        if (isCabbyCodesSymbol(symbol)) {
            this.drawCabbyCodesOptionBackground(index);
            return;
        }
        _Window_Options_drawItemBackground.call(this, index);
    };

    Window_Options.prototype.drawCabbyCodesOptionBackground = function(index) {
        const rect = this.itemRect(index);
        const x = rect.x + CABBYCODES_OPTION_BG_PADDING;
        const y = rect.y;
        const width = Math.max(0, rect.width - CABBYCODES_OPTION_BG_PADDING * 2);
        const height = rect.height;
        const backContext = this.contentsBack;
        if (!backContext) {
            return;
        }
        backContext.gradientFillRect(
            x,
            y,
            width,
            height,
            CABBYCODES_OPTION_BG_COLOR_START,
            CABBYCODES_OPTION_BG_COLOR_END,
            true
        );
        backContext.strokeRect(x, y, width, height, CABBYCODES_OPTION_BG_COLOR_BORDER);
    };
    
    /**
     * Custom numeric input scene for CabbyCodes settings.
     */
    function Scene_CabbyCodesNumberInput() {
        this.initialize(...arguments);
    }
    
    window.Scene_CabbyCodesNumberInput = Scene_CabbyCodesNumberInput;
    
    Scene_CabbyCodesNumberInput.prototype = Object.create(Scene_MenuBase.prototype);
    Scene_CabbyCodesNumberInput.prototype.constructor = Scene_CabbyCodesNumberInput;
    
    Scene_CabbyCodesNumberInput.prototype.prepare = function(definition, initialValue, callbacks = {}) {
        this._settingDefinition = definition;
        this._initialValue = initialValue;
        this._callbacks = callbacks;
    };
    
    Scene_CabbyCodesNumberInput.prototype.create = function() {
        Scene_MenuBase.prototype.create.call(this);
        this.createHelpWindow();
        this.createNumberWindow();
    };
    
    Scene_CabbyCodesNumberInput.prototype.helpAreaHeight = function() {
        return this.calcWindowHeight(1, false);
    };
    
    Scene_CabbyCodesNumberInput.prototype.createHelpWindow = function() {
        const rect = this.helpWindowRect();
        this._helpWindow = new Window_Help(rect);
        const title = this._settingDefinition?.inputTitle || this._settingDefinition?.displayName || 'Enter Value';
        const description = this._settingDefinition?.inputDescription || '';
        this._helpWindow.setText(`${title}\n${description}`.trim());
        this.addWindow(this._helpWindow);
    };
    
    Scene_CabbyCodesNumberInput.prototype.numberWindowRect = function() {
        const helpHeight = this.helpAreaHeight();
        const ww = 360;
        const wh = this.calcWindowHeight(2, true);
        const wx = (Graphics.boxWidth - ww) / 2;
        const wy = helpHeight + 24;
        return new Rectangle(wx, wy, ww, wh);
    };
    
    Scene_CabbyCodesNumberInput.prototype.createNumberWindow = function() {
        const rect = this.numberWindowRect();
        this._numberWindow = new Window_CabbyCodesNumberInput(rect, this._settingDefinition, this._initialValue);
        this._numberWindow.setHandler('ok', this.onNumberOk.bind(this));
        this._numberWindow.setHandler('cancel', this.onNumberCancel.bind(this));
        this.addWindow(this._numberWindow);
        this._numberWindow.activate();
        this._numberWindow.select(0);
    };
    
    Scene_CabbyCodesNumberInput.prototype.onNumberOk = function() {
        const value = this._numberWindow.value();
        if (this._callbacks && typeof this._callbacks.onApply === 'function') {
            this._callbacks.onApply(value);
        }
        SceneManager.pop();
    };
    
    Scene_CabbyCodesNumberInput.prototype.onNumberCancel = function() {
        if (this._callbacks && typeof this._callbacks.onCancel === 'function') {
            this._callbacks.onCancel();
        }
        SceneManager.pop();
    };
    
    /**
     * Numeric entry window that supports direct typing.
     */
    function Window_CabbyCodesNumberInput() {
        this.initialize(...arguments);
    }
    
    window.Window_CabbyCodesNumberInput = Window_CabbyCodesNumberInput;
    
    Window_CabbyCodesNumberInput.prototype = Object.create(Window_Selectable.prototype);
    Window_CabbyCodesNumberInput.prototype.constructor = Window_CabbyCodesNumberInput;
    
    Window_CabbyCodesNumberInput.prototype.initialize = function(rect, definition, initialValue) {
        Window_Selectable.prototype.initialize.call(this, rect);
        this._definition = definition;
        this._maxDigits = determineMaxDigits(definition);
        this._min = typeof definition.min === 'number' ? definition.min : null;
        this._max = typeof definition.max === 'number' ? definition.max : null;
        this._value = CabbyCodes.normalizeSettingValue(definition, initialValue);
        this._textBuffer = String(this._value);
        this._boundKeyHandler = this.onKeyDown.bind(this);
        window.addEventListener('keydown', this._boundKeyHandler, true);
        this.refresh();
    };
    
    Window_CabbyCodesNumberInput.prototype.destroy = function(options) {
        window.removeEventListener('keydown', this._boundKeyHandler, true);
        Window_Selectable.prototype.destroy.call(this, options);
    };
    
    Window_CabbyCodesNumberInput.prototype.maxItems = function() {
        return 1;
    };
    
    Window_CabbyCodesNumberInput.prototype.itemHeight = function() {
        return this.lineHeight();
    };
    
    Window_CabbyCodesNumberInput.prototype.drawItem = function(index) {
        if (index !== 0) {
            return;
        }
        const rect = this.itemLineRect(index);
        this.drawText(this.displayText(), rect.x, rect.y, rect.width, 'center');
    };
    
    Window_CabbyCodesNumberInput.prototype.displayText = function() {
        if (typeof this._definition.formatValue === 'function') {
            return this._definition.formatValue(this._value);
        }
        return String(this._value);
    };
    
    Window_CabbyCodesNumberInput.prototype.value = function() {
        return this._value;
    };
    
    Window_CabbyCodesNumberInput.prototype.isOkEnabled = function() {
        return true;
    };
    
    Window_CabbyCodesNumberInput.prototype.isCancelEnabled = function() {
        return true;
    };
    
    Window_CabbyCodesNumberInput.prototype.processOk = function() {
        this.playOkSound();
        this.updateValueFromBuffer();
        this.callOkHandler();
    };
    
    Window_CabbyCodesNumberInput.prototype.processCancel = function() {
        SoundManager.playCancel();
        this.updateInputData();
        this.deactivate();
        this.callCancelHandler();
    };
    
    Window_CabbyCodesNumberInput.prototype.processHandling = function() {
        Window_Selectable.prototype.processHandling.call(this);
        if (this.isOpenAndActive()) {
            if (Input.isRepeated('up')) {
                this.adjustValue(this._definition.step || 1);
            } else if (Input.isRepeated('down')) {
                this.adjustValue(-(this._definition.step || 1));
            }
        }
    };
    
    Window_CabbyCodesNumberInput.prototype.adjustValue = function(delta) {
        let newValue = this._value + delta;
        if (typeof this._min === 'number') {
            newValue = Math.max(this._min, newValue);
        }
        if (typeof this._max === 'number') {
            newValue = Math.min(this._max, newValue);
        }
        this._value = newValue;
        this._textBuffer = String(newValue);
        this.refresh();
    };
    
    Window_CabbyCodesNumberInput.prototype.onKeyDown = function(event) {
        if (!this.active) {
            return;
        }
        if (event.key >= '0' && event.key <= '9') {
            this.inputDigit(event.key);
            event.preventDefault();
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
            this.eraseDigit();
            event.preventDefault();
        } else if (event.key === '-' && (this._min == null || this._min < 0)) {
            this.toggleNegative();
            event.preventDefault();
        }
    };
    
    Window_CabbyCodesNumberInput.prototype.inputDigit = function(digit) {
        if (this._textBuffer === '0') {
            this._textBuffer = '';
        }
        if (this._textBuffer.replace('-', '').length >= this._maxDigits) {
            return;
        }
        this._textBuffer += digit;
        this.updateValueFromBuffer();
    };
    
    Window_CabbyCodesNumberInput.prototype.eraseDigit = function() {
        if (this._textBuffer.length <= 1 || (this._textBuffer.length === 2 && this._textBuffer.startsWith('-'))) {
            this._textBuffer = this._textBuffer.startsWith('-') ? '-' : '0';
        } else {
            this._textBuffer = this._textBuffer.slice(0, -1);
        }
        this.updateValueFromBuffer();
    };
    
    Window_CabbyCodesNumberInput.prototype.toggleNegative = function() {
        if (this._textBuffer.startsWith('-')) {
            this._textBuffer = this._textBuffer.substring(1);
        } else {
            this._textBuffer = `-${this._textBuffer}`;
        }
        this.updateValueFromBuffer();
    };
    
    Window_CabbyCodesNumberInput.prototype.updateValueFromBuffer = function() {
        const parsed = Number(this._textBuffer);
        if (Number.isNaN(parsed)) {
            this._value = 0;
        } else {
            this._value = parsed;
        }
        this._value = CabbyCodes.normalizeSettingValue(this._definition, this._value);
        this._textBuffer = String(this._value);
        this.refresh();
    };
    
    function determineMaxDigits(definition) {
        if (typeof definition.maxDigits === 'number' && definition.maxDigits > 0) {
            return definition.maxDigits;
        }
        if (typeof definition.max === 'number') {
            return Math.max(String(Math.abs(definition.max)).length, 1);
        }
        return 8;
    }
    
    // Example: Register a sample setting (can be removed or used as template)
    // CabbyCodes.registerSetting('exampleFeature', 'Example Feature', false);
    
    CabbyCodes.log('[CabbyCodes] Settings module loaded');
})();

