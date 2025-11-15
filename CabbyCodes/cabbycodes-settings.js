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
    
    // Settings registry - stores all registered settings
    CabbyCodes.settingsRegistry = CabbyCodes.settingsRegistry || [];
    
    /**
     * Register a new setting
     * @param {string} key - Unique key for the setting
     * @param {string} displayName - Name shown in the options menu
     * @param {boolean} defaultValue - Default value (true/false)
     * @param {Function} onChange - Optional callback when setting changes
     */
    CabbyCodes.registerSetting = function(key, displayName, defaultValue = false, onChange = null) {
        CabbyCodes.settingsRegistry.push({
            key: key,
            displayName: displayName,
            defaultValue: defaultValue,
            onChange: onChange
        });
        
        // Initialize setting if it doesn't exist
        if (!CabbyCodes.settings.hasOwnProperty(key)) {
            CabbyCodes.setSetting(key, defaultValue);
        }
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
        
        if (CabbyCodes.settingsRegistry.length > 0) {
            CabbyCodes.settingsRegistry.forEach(setting => {
                this.addCommand(setting.displayName, `cabbycodes_${setting.key}`, true);
            });
        }
    };
    
    // Hook into Window_Options to handle setting values
    const _Window_Options_getConfigValue = Window_Options.prototype.getConfigValue;
    Window_Options.prototype.getConfigValue = function(symbol) {
        if (symbol.startsWith('cabbycodes_')) {
            const key = symbol.replace('cabbycodes_', '');
            return CabbyCodes.getSetting(key, false);
        }
        return _Window_Options_getConfigValue.call(this, symbol);
    };
    
    // Hook into Window_Options to handle setting changes
    const _Window_Options_setConfigValue = Window_Options.prototype.setConfigValue;
    Window_Options.prototype.setConfigValue = function(symbol, value) {
        if (symbol.startsWith('cabbycodes_')) {
            const key = symbol.replace('cabbycodes_', '');
            const oldValue = CabbyCodes.getSetting(key, false);
            CabbyCodes.setSetting(key, value);
            
            // Call onChange callback if provided
            const setting = CabbyCodes.settingsRegistry.find(s => s.key === key);
            if (setting && setting.onChange) {
                setting.onChange(value, oldValue);
            }
        } else {
            _Window_Options_setConfigValue.call(this, symbol, value);
        }
    };
    
    // Hook into Window_Options status text for boolean display
    const _Window_Options_statusText = Window_Options.prototype.statusText;
    Window_Options.prototype.statusText = function(index) {
        const symbol = this.commandSymbol(index);
        if (symbol.startsWith('cabbycodes_')) {
            const value = this.getConfigValue(symbol);
            return this.booleanStatusText(value);
        }
        return _Window_Options_statusText.call(this, index);
    };
    
    // Example: Register a sample setting (can be removed or used as template)
    // CabbyCodes.registerSetting('exampleFeature', 'Example Feature', false);
    
    console.log('[CabbyCodes] Settings module loaded');
})();

