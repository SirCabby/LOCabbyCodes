//=============================================================================
// CabbyCodes Core
//=============================================================================
/*:
 * @target MZ
 * @plugindesc CabbyCodes Core - Modding framework and initialization
 * @author CabbyCodes
 * @help
 * Core functionality for the CabbyCodes modding system.
 * Provides hooking utilities and settings framework.
 */

(() => {
    'use strict';

    // CabbyCodes namespace
    window.CabbyCodes = window.CabbyCodes || {};
    
    // Settings storage key
    const SETTINGS_KEY = 'CabbyCodes_Settings';
    
    // Initialize settings
    CabbyCodes.settings = {};
    
    // Load settings from localStorage
    CabbyCodes.loadSettings = function() {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            if (saved) {
                CabbyCodes.settings = JSON.parse(saved);
            }
        } catch (e) {
            console.error('[CabbyCodes] Failed to load settings:', e);
            CabbyCodes.settings = {};
        }
    };
    
    // Save settings to localStorage
    CabbyCodes.saveSettings = function() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(CabbyCodes.settings));
        } catch (e) {
            console.error('[CabbyCodes] Failed to save settings:', e);
        }
    };
    
    // Get a setting value
    CabbyCodes.getSetting = function(key, defaultValue = false) {
        if (CabbyCodes.settings.hasOwnProperty(key)) {
            return CabbyCodes.settings[key];
        }
        return defaultValue;
    };
    
    // Set a setting value
    CabbyCodes.setSetting = function(key, value) {
        CabbyCodes.settings[key] = value;
        CabbyCodes.saveSettings();
    };
    
    // Initialize on load
    CabbyCodes.loadSettings();
    
    // Hook storage for settings persistence
    console.log('[CabbyCodes] Core initialized');
})();

