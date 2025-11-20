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

    /**
     * Log level control. When false (default), only WARN and ERROR messages are logged.
     * When true, all log levels (INFO, WARN, ERROR, DEBUG) are logged.
     * @type {boolean}
     */
    CabbyCodes.debugLoggingEnabled = CabbyCodes.debugLoggingEnabled ?? false;
    
    /**
     * Log levels: DEBUG < INFO < WARN < ERROR
     * By default, only WARN and ERROR are logged.
     */
    const LOG_LEVELS = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    };
    
    /**
     * Get the current minimum log level based on debugLoggingEnabled setting.
     * @returns {number} Minimum log level (WARN by default, DEBUG if debug logging enabled)
     */
    function getMinLogLevel() {
        return CabbyCodes.debugLoggingEnabled ? LOG_LEVELS.DEBUG : LOG_LEVELS.WARN;
    }
    
    /**
     * Log a message with stack trace if it's an error.
     * @param {string|Error} message - The message or Error object to log
     * @param {number} level - The log level
     * @param {Function} consoleFn - The console function to call
     */
    function logWithLevel(message, level, consoleFn) {
        const minLevel = getMinLogLevel();
        if (level < minLevel) {
            return; // Don't log if below minimum level
        }
        
        // For errors, include stack trace
        if (level === LOG_LEVELS.ERROR) {
            if (message instanceof Error) {
                consoleFn(message);
                if (message.stack) {
                    consoleFn(message.stack);
                }
            } else {
                // Create an Error to get stack trace
                const error = new Error(message);
                consoleFn(error);
                if (error.stack) {
                    consoleFn(error.stack);
                }
            }
        } else {
            consoleFn(message);
        }
    }
    
    // Basic logging shims (can be enhanced by other modules)
    CabbyCodes.log = CabbyCodes.log || function(message) {
        logWithLevel(message, LOG_LEVELS.INFO, console.log);
    };
    CabbyCodes.warn = CabbyCodes.warn || function(message) {
        logWithLevel(message, LOG_LEVELS.WARN, console.warn);
    };
    CabbyCodes.error = CabbyCodes.error || function(message) {
        logWithLevel(message, LOG_LEVELS.ERROR, console.error);
    };
    CabbyCodes.debugEnabled = CabbyCodes.debugEnabled ?? false;
    CabbyCodes.debug = CabbyCodes.debug || function(...args) {
        if (!CabbyCodes.debugEnabled) {
            return;
        }
        const minLevel = getMinLogLevel();
        if (LOG_LEVELS.DEBUG < minLevel) {
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

