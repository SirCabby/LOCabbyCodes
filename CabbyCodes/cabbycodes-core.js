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
    
    /**
     * Current CabbyCodes version. This value is kept in sync with the root
     * VERSION file so it can be displayed inside the game.
     * @type {string}
     */
    CabbyCodes.version = '0.0.1';

    // Basic logging shims (can be enhanced by other modules)
    CabbyCodes.log = CabbyCodes.log || function(message) {
        console.log(message);
    };
    CabbyCodes.warn = CabbyCodes.warn || function(message) {
        console.warn(message);
    };
    CabbyCodes.error = CabbyCodes.error || function(message) {
        console.error(message);
    };
    CabbyCodes.debugEnabled = CabbyCodes.debugEnabled ?? false;
    CabbyCodes.debug = CabbyCodes.debug || function(...args) {
        if (!CabbyCodes.debugEnabled) {
            return;
        }
        if (typeof console !== 'undefined' && typeof console.debug === 'function') {
            console.debug(...args);
        } else if (typeof console !== 'undefined' && typeof console.log === 'function') {
            console.log(...args);
        }
    };
    
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
            CabbyCodes.error(`[CabbyCodes] Failed to load settings: ${e?.message || e}`);
            CabbyCodes.settings = {};
        }
    };
    
    // Save settings to localStorage
    CabbyCodes.saveSettings = function() {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(CabbyCodes.settings));
        } catch (e) {
            CabbyCodes.error(`[CabbyCodes] Failed to save settings: ${e?.message || e}`);
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
    CabbyCodes.log('[CabbyCodes] Core initialized');
})();

